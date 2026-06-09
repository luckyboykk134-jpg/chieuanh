import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Settings, Upload, EyeOff, Eye, Image as ImageIcon, Sliders, Zap, Maximize, Minimize, Crosshair, X, Gauge, Cloud, CloudOff } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

// Khởi tạo Firebase
let app, auth, db, appId;
try {
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
  if (firebaseConfig) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  }
} catch (e) {
  console.error("Firebase init error", e);
}

// Helper: Nén ảnh để lưu trữ (Giúp tiết kiệm dung lượng khi lưu lên Cloud)
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1920;
        const MAX_HEIGHT = 1920;
        let width = img.width;
        let height = img.height;
        if (width > height && width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        } else if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7)); // Nén JPEG 70% để tối ưu dung lượng
      };
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Hình ảnh mặc định chất lượng cao để hiển thị ban đầu
const DEFAULT_IMAGES = [
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?q=80&w=1920&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1506744626753-dba37c152d13?q=80&w=1920&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?q=80&w=1920&auto=format&fit=crop'
];

export default function App() {
  const [images, setImages] = useState(DEFAULT_IMAGES);
  
  // Các thông số điều khiển toàn cục
  const [intervalTime, setIntervalTime] = useState(4); // Chu kỳ chuyển ảnh (3-6 giây)
  const [transitionSpeed, setTransitionSpeed] = useState(0.3); // Tốc độ hiệu ứng đổi ảnh (0.1-0.5 giây)
  const [globalZoomDuration, setGlobalZoomDuration] = useState(15); // Tốc độ Zoom liên tục (Tính bằng tổng thời gian zoom từ Start -> End)
  const [effectType, setEffectType] = useState('fade'); // fade, slide, blur, flip
  
  const [isPlaying, setIsPlaying] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  
  // State cho Lưu trữ đám mây
  const [user, setUser] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  // Trạng thái quản lý thứ tự hiển thị và hiệu ứng
  const [order, setOrder] = useState([0, 1, 2]);
  const [animState, setAnimState] = useState('reset'); // Bắt đầu ở 'reset' để mồi hiệu ứng zoom đầu tiên

  // Trạng thái quản lý Tiêu điểm và Khung hình TỪNG ẢNH
  const [focusPoints, setFocusPoints] = useState([
    { startX: 50, startY: 50, endX: 50, endY: 25, startScale: 1, endScale: 3 },
    { startX: 50, startY: 50, endX: 50, endY: 25, startScale: 1, endScale: 3 },
    { startX: 50, startY: 50, endX: 50, endY: 25, startScale: 1, endScale: 3 }
  ]);
  const [editingFocusIdx, setEditingFocusIdx] = useState(null);
  const [editMode, setEditMode] = useState('end'); // 'start' hoặc 'end'

  const fileInputRefs = [useRef(null), useRef(null), useRef(null)];

  // Khởi tạo Auth
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Lỗi xác thực Firebase", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Tải Dữ liệu từ Firebase (Chỉ chạy khi mới vào trang)
  useEffect(() => {
    if (!user || !db) return;
    const loadData = async () => {
      try {
        // Tải cấu hình
        const settingsDoc = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'main'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          if(data.intervalTime) setIntervalTime(data.intervalTime);
          if(data.transitionSpeed) setTransitionSpeed(data.transitionSpeed);
          if(data.globalZoomDuration) setGlobalZoomDuration(data.globalZoomDuration);
          if(data.effectType) setEffectType(data.effectType);
          if(data.focusPoints) setFocusPoints(data.focusPoints);
        }

        // Tải hình ảnh
        const loadedImages = [...DEFAULT_IMAGES];
        let hasCustomImages = false;
        for (let i = 0; i < 3; i++) {
          const imgDoc = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'images', `img_${i}`));
          if (imgDoc.exists()) {
            loadedImages[i] = imgDoc.data().dataUrl;
            hasCustomImages = true;
          }
        }
        if (hasCustomImages) setImages(loadedImages);
        
        setIsDataLoaded(true);
        setToastMsg("Đã tải dữ liệu lưu trữ thành công!");
        setTimeout(() => setToastMsg(''), 3000);
      } catch (e) {
        console.error("Lỗi tải dữ liệu", e);
      }
    };
    loadData();
  }, [user]);

  // Tự động Lưu Cấu hình mỗi khi bạn tinh chỉnh (Debounce 1.5s để không bị lag)
  useEffect(() => {
    if (!user || !db || !isDataLoaded) return;
    const timer = setTimeout(async () => {
      setIsSaving(true);
      try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'main'), {
          intervalTime,
          transitionSpeed,
          globalZoomDuration,
          effectType,
          focusPoints
        });
      } catch (e) {
        console.error("Lỗi lưu cấu hình", e);
      } finally {
        setTimeout(() => setIsSaving(false), 500);
      }
    }, 1500); 
    return () => clearTimeout(timer);
  }, [intervalTime, transitionSpeed, globalZoomDuration, effectType, focusPoints, user, isDataLoaded]);

  // Kích hoạt hiệu ứng zoom cho lần tải đầu tiên
  useEffect(() => {
    const timer = setTimeout(() => setAnimState('idle'), 50);
    return () => clearTimeout(timer);
  }, []);

  // Xử lý sự kiện toàn màn hình
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleFullscreen = async () => {
    if (!document.fullscreenEnabled) {
      setToastMsg("Môi trường này không hỗ trợ toàn màn hình.");
      return;
    }

    try {
      const elem = document.documentElement;
      if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.error("Lỗi:", err);
      setToastMsg("Không thể mở toàn màn hình do chính sách bảo mật.");
    }
  };

  // Vòng lặp chính xử lý chuyển đổi ảnh
  useEffect(() => {
    if (!isPlaying) return;
    let isCancelled = false;

    const runCycle = async () => {
      if (isCancelled) return;

      setAnimState('zooming');
      await new Promise(r => setTimeout(r, transitionSpeed * 1000 * 0.5));
      if (isCancelled) return;

      setAnimState('swapping');
      await new Promise(r => setTimeout(r, transitionSpeed * 1000 * 0.5));
      if (isCancelled) return;

      setOrder(prev => [prev[2], prev[0], prev[1]]);

      setAnimState('reset');
      await new Promise(r => setTimeout(r, 50)); 
      if (isCancelled) return;

      setAnimState('idle');
    };

    const intervalId = setInterval(runCycle, intervalTime * 1000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [isPlaying, intervalTime, transitionSpeed]);

  const handleFileUpload = async (index, event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        setIsSaving(true);
        const dataUrl = await compressImage(file);
        
        setImages(prev => {
          const newImgs = [...prev];
          newImgs[index] = dataUrl;
          return newImgs;
        });
        
        const newPointsConfig = { startX: 50, startY: 50, endX: 50, endY: 25, startScale: 1, endScale: 3 };
        setFocusPoints(prev => {
          const newPoints = [...prev];
          newPoints[index] = newPointsConfig;
          return newPoints;
        });

        if (user && db) {
          await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'images', `img_${index}`), {
            dataUrl: dataUrl
          });
        }
      } catch (e) {
        console.error("Lỗi upload ảnh", e);
        setToastMsg("Có lỗi xảy ra khi xử lý ảnh.");
        setTimeout(() => setToastMsg(''), 4000);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const updateFocusParams = (index, field, value) => {
    setFocusPoints(prev => {
      const newPoints = [...prev];
      newPoints[index] = { ...newPoints[index], [field]: value };
      
      if (field === 'startScale' && value > newPoints[index].endScale) {
        newPoints[index].endScale = value;
      }
      return newPoints;
    });
  };

  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden font-sans text-white">
      {/* MÀN HÌNH CHIA 3 PHẦN */}
      <div className="flex w-full h-full">
        {[0, 1, 2].map((panelIndex) => {
          const imageIndex = order[panelIndex];
          const focus = focusPoints[imageIndex];

          let outerTransform = 'scale(1)';
          let outerOpacity = 1;
          let outerFilter = 'blur(0px)';
          let outerTransition = `opacity ${transitionSpeed}s ease-out, transform ${transitionSpeed}s ease-out`;

          if (animState === 'reset') {
            outerOpacity = 0;
            outerTransition = 'none';
          } else if (animState === 'zooming') {
            outerTransform = 'scale(1.05)';
            outerTransition = `transform ${transitionSpeed * 0.5}s ease-in`;
          } else if (animState === 'swapping') {
            if (effectType === 'slide') outerTransform = 'scale(1.05) translateY(-15%)';
            else if (effectType === 'flip') outerTransform = 'scale(1.05) rotateX(90deg)';
            else outerTransform = 'scale(1.05)';
            
            outerOpacity = 0;
            if (effectType === 'blur') outerFilter = 'blur(20px)';
            outerTransition = `all ${transitionSpeed * 0.5}s ease-in-out`;
          }

          let innerTransform = `scale(${focus.endScale})`;
          let innerOrigin = `${focus.endX}% ${focus.endY}%`;
          let innerTransition = `transform ${globalZoomDuration}s linear, transform-origin ${globalZoomDuration}s linear, object-position ${globalZoomDuration}s linear`;

          if (animState === 'reset') {
            innerTransform = `scale(${focus.startScale})`;
            innerOrigin = `${focus.startX}% ${focus.startY}%`;
            innerTransition = 'none';
          }

          return (
            <div key={panelIndex} className="flex-1 relative overflow-hidden border-r border-slate-900/50 last:border-0 bg-black">
              <div 
                className="absolute inset-0"
                style={{
                  transform: outerTransform,
                  opacity: outerOpacity,
                  filter: outerFilter,
                  transition: outerTransition
                }}
              >
                <img
                  src={images[imageIndex]}
                  alt={`Panel ${panelIndex}`}
                  className="w-full h-full object-cover"
                  style={{
                    transformOrigin: innerOrigin,
                    objectPosition: innerOrigin,
                    transform: innerTransform,
                    transition: innerTransition
                  }}
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
            </div>
          );
        })}
      </div>

      {/* THÔNG BÁO LỖI TOAST */}
      {toastMsg && (
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-[100] bg-rose-500/90 text-white px-6 py-3 rounded-full shadow-lg backdrop-blur-md flex items-center gap-2 animate-bounce">
          <X size={18} />
          <span className="font-medium">{toastMsg}</span>
        </div>
      )}

      {/* NÚT ĐIỀU KHIỂN GÓC PHẢI */}
      <div className="absolute top-6 right-6 z-50 flex gap-3">
        <button onClick={handleFullscreen} className="p-3 bg-black/40 hover:bg-black/70 backdrop-blur-md rounded-full transition-all text-white/80 hover:text-white shadow-lg">
          {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
        </button>
        <button onClick={() => setShowControls(!showControls)} className="p-3 bg-black/40 hover:bg-black/70 backdrop-blur-md rounded-full transition-all text-white/80 hover:text-white shadow-lg">
          {showControls ? <EyeOff size={24} /> : <Eye size={24} />}
        </button>
      </div>

      {/* BẢNG ĐIỀU KHIỂN CHÍNH */}
      <div 
        className={`absolute bottom-8 left-1/2 transform -translate-x-1/2 z-40 flex flex-col gap-6 p-6 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl transition-all duration-500 w-[95%] max-w-4xl ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
              <Settings size={20} />
            </div>
            <h2 className="text-xl font-semibold tracking-wide">Điều khiển Trình chiếu</h2>
            <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all ${isSaving ? 'bg-amber-500/20 text-amber-400' : (user ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400')}`}>
              {isSaving ? <><Cloud size={14} className="animate-pulse" /> Đang lưu...</> : (user ? <><Cloud size={14} /> Đã lưu</> : <><CloudOff size={14} /> Cloud Offline</>)}
            </div>
          </div>
          
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-medium transition-all shadow-lg ${
              isPlaying ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
            }`}
          >
            {isPlaying ? <><Pause size={18} /> Tạm dừng</> : <><Play size={18} /> Phát tiếp</>}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <ImageIcon size={16} /> Hình ảnh & Khung hình cá nhân
            </label>
            <div className="flex gap-3 justify-between">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="relative group flex-1 aspect-video rounded-xl overflow-hidden border border-white/10 hover:border-indigo-400/50 transition-colors">
                  <img src={images[idx]} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" alt="preview" />
                  
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => fileInputRefs[idx].current.click()} className="p-2.5 bg-white/20 hover:bg-white/40 rounded-full backdrop-blur-md transition-colors text-white" title="Tải ảnh mới">
                      <Upload size={16} />
                    </button>
                    <button onClick={() => setEditingFocusIdx(idx)} className="p-2.5 bg-indigo-500/80 hover:bg-indigo-400 rounded-full backdrop-blur-md transition-colors text-white shadow-lg shadow-indigo-500/30" title="Chỉnh khung hình / Tiêu điểm">
                      <Crosshair size={16} />
                    </button>
                  </div>
                  
                  <input type="file" accept="image/*" ref={fileInputRefs[idx]} className="hidden" onChange={(e) => handleFileUpload(idx, e)} />
                  <div className="absolute bottom-1 left-2 text-[10px] font-bold px-2 py-0.5 bg-black/60 rounded backdrop-blur-sm pointer-events-none">ẢNH {idx + 1}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm text-slate-300 font-medium">
                <label className="flex items-center gap-2"><Sliders size={16}/> Chu kỳ chuyển ảnh</label>
                <span className="text-indigo-400 font-mono">{intervalTime}s</span>
              </div>
              <input type="range" min="3" max="10" step="0.5" value={intervalTime} onChange={(e) => setIntervalTime(parseFloat(e.target.value))} className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-sm text-slate-300 font-medium">
                <label className="flex items-center gap-2"><Zap size={16}/> Tốc độ Đổi / Pulse</label>
                <span className="text-indigo-400 font-mono">{transitionSpeed}s</span>
              </div>
              <input type="range" min="0.1" max="0.5" step="0.1" value={transitionSpeed} onChange={(e) => setTransitionSpeed(parseFloat(e.target.value))} className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-sm text-slate-300 font-medium">
                <label className="flex items-center gap-2"><Gauge size={16}/> Tốc độ Zoom Sâu (Thời lượng)</label>
                <span className="text-indigo-400 font-mono">{globalZoomDuration}s</span>
              </div>
              <input type="range" min="2" max="60" step="1" value={globalZoomDuration} onChange={(e) => setGlobalZoomDuration(parseInt(e.target.value))} className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
            </div>

            <div className="flex items-center justify-between bg-white/5 p-1.5 rounded-xl border border-white/5 mt-2">
              {['fade', 'slide', 'blur', 'flip'].map((type) => (
                <button
                  key={type} onClick={() => setEffectType(type)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-all ${effectType === type ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                >
                  {type === 'fade' ? 'Mờ dần' : type === 'slide' ? 'Trượt' : type === 'blur' ? 'Mờ nhòe' : 'Lật 3D'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL CÀI ĐẶT KHUNG HÌNH (FOCUS EDITOR) - ĐÃ TỐI ƯU CUỘN DỌC */}
      {editingFocusIdx !== null && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4 backdrop-blur-md overflow-hidden">
          <div className="w-full max-w-4xl h-full flex flex-col py-6">
            <div className="flex justify-between items-end mb-4 text-white flex-shrink-0">
              <div>
                <h3 className="text-2xl font-bold mb-1 flex items-center gap-2">
                  <Crosshair className="text-indigo-400"/> Thiết lập Góc máy (Ảnh {editingFocusIdx + 1})
                </h3>
                <p className="text-slate-400 text-sm">Sử dụng thanh cuộn bên phải để lên/xuống. Chọn Tab để set tọa độ.</p>
              </div>
              <button onClick={() => setEditingFocusIdx(null)} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full font-medium transition-colors flex items-center gap-2">
                Xong <X size={18} />
              </button>
            </div>
            
            <div className="flex gap-4 mb-4 justify-center w-full flex-shrink-0">
                <button 
                    onClick={() => setEditMode('start')}
                    className={`flex-1 py-3 rounded-xl font-bold transition-all border-2 ${editMode === 'start' ? 'border-indigo-500 bg-indigo-500/20 text-white' : 'border-transparent bg-white/5 text-slate-400'}`}
                >
                    1. ĐIỂM BẮT ĐẦU (START)
                </button>
                <button 
                    onClick={() => setEditMode('end')}
                    className={`flex-1 py-3 rounded-xl font-bold transition-all border-2 ${editMode === 'end' ? 'border-rose-500 bg-rose-500/20 text-white' : 'border-transparent bg-white/5 text-slate-400'}`}
                >
                    2. ĐIỂM KẾT THÚC (END)
                </button>
            </div>

            {/* Viewport: Cho phép cuộn dọc thoải mái cho ảnh dài */}
            <div className="flex-grow overflow-y-auto border border-white/20 rounded-xl bg-slate-900 custom-scrollbar shadow-inner">
              <div 
                className="relative w-full select-none cursor-crosshair"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 100;
                  const y = ((e.clientY - rect.top) / rect.height) * 100;
                  
                  if (editMode === 'start') {
                      updateFocusParams(editingFocusIdx, 'startX', Math.max(0, Math.min(100, x)));
                      updateFocusParams(editingFocusIdx, 'startY', Math.max(0, Math.min(100, y)));
                  } else {
                      updateFocusParams(editingFocusIdx, 'endX', Math.max(0, Math.min(100, x)));
                      updateFocusParams(editingFocusIdx, 'endY', Math.max(0, Math.min(100, y)));
                  }
                }}
              >
                <img 
                  src={images[editingFocusIdx]} 
                  alt="Edit focus"
                  className="w-full h-auto block opacity-60"
                  draggable="false"
                />
                
                {/* Box End */}
                <div 
                  className={`absolute border-[2px] transition-all duration-300 pointer-events-none ${editMode === 'end' ? 'border-rose-500 bg-rose-500/20 z-30' : 'border-rose-500/50 z-10'}`}
                  style={{
                    left: `${focusPoints[editingFocusIdx].endX - focusPoints[editingFocusIdx].endX / focusPoints[editingFocusIdx].endScale}%`,
                    top: `${focusPoints[editingFocusIdx].endY - focusPoints[editingFocusIdx].endY / focusPoints[editingFocusIdx].endScale}%`,
                    width: `${100 / focusPoints[editingFocusIdx].endScale}%`,
                    height: `${100 / focusPoints[editingFocusIdx].endScale * (9/16) * (images[editingFocusIdx].height/images[editingFocusIdx].width || 1)}%`, // Ước tính chiều cao khung hình
                    aspectRatio: '16 / 9'
                  }}
                >
                   <div className="absolute top-0 right-0 bg-rose-500 text-white text-[10px] px-1 py-0.5">END</div>
                </div>

                {/* Box Start */}
                <div 
                  className={`absolute border-[2px] transition-all duration-300 pointer-events-none ${editMode === 'start' ? 'border-indigo-400 bg-indigo-500/20 z-30' : 'border-indigo-400/50 z-10'}`}
                  style={{
                    left: `${focusPoints[editingFocusIdx].startX - focusPoints[editingFocusIdx].startX / focusPoints[editingFocusIdx].startScale}%`,
                    top: `${focusPoints[editingFocusIdx].startY - focusPoints[editingFocusIdx].startY / focusPoints[editingFocusIdx].startScale}%`,
                    width: `${100 / focusPoints[editingFocusIdx].startScale}%`,
                    aspectRatio: '16 / 9'
                  }}
                >
                   <div className="absolute top-0 left-0 bg-indigo-500 text-white text-[10px] px-1 py-0.5">START</div>
                </div>
                
                <div 
                  className="absolute w-8 h-8 pointer-events-none transition-all duration-300 z-40"
                  style={{
                    left: `${editMode === 'start' ? focusPoints[editingFocusIdx].startX : focusPoints[editingFocusIdx].endX}%`,
                    top: `${editMode === 'start' ? focusPoints[editingFocusIdx].startY : focusPoints[editingFocusIdx].endY}%`,
                    transform: `translate(-50%, -50%)`
                  }}
                >
                  <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white rounded-full transform -translate-x-1/2 -translate-y-1/2 shadow-xl" />
                  <div className="absolute top-0 bottom-0 left-1/2 w-[2px] bg-white transform -translate-x-1/2" />
                  <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-white transform -translate-y-1/2" />
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col md:flex-row gap-8 bg-white/5 p-6 rounded-2xl border border-white/10 flex-shrink-0">
              <div className="flex-1 space-y-3">
                <div className="flex justify-between text-sm">
                  <span>Start Scale</span>
                  <span className="text-indigo-400">{focusPoints[editingFocusIdx].startScale}x</span>
                </div>
                <input type="range" min="1" max="20" step="0.1" value={focusPoints[editingFocusIdx].startScale} onChange={(e) => updateFocusParams(editingFocusIdx, 'startScale', parseFloat(e.target.value))} className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex justify-between text-sm">
                  <span>End Scale</span>
                  <span className="text-rose-400">{focusPoints[editingFocusIdx].endScale}x</span>
                </div>
                <input type="range" min={focusPoints[editingFocusIdx].startScale} max="50" step="0.5" value={focusPoints[editingFocusIdx].endScale} onChange={(e) => updateFocusParams(editingFocusIdx, 'endScale', parseFloat(e.target.value))} className="w-full accent-rose-500 h-2 bg-slate-800 rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* CSS cho thanh cuộn tùy chỉnh */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.3); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.5); }
      `}</style>
    </div>
  );
}
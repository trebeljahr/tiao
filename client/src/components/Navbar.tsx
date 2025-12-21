// import { AnimatePresence, motion } from "framer-motion";
// import { forwardRef, useRef, useState } from "react";
// import { FaBars, FaX } from "react-icons/fa6";
// import { NavLink } from "react-router-dom";
// import { useAuth } from "../context/auth.context";
// import {
//   FoldableUserLogo,
//   useCloseWhenClickedOutside,
// } from "./FoldableUserLogo";
// import { CustomNavLink } from "./CustomNavlink";

// export const Navbar = () => {
//   const { user } = useAuth();
//   const [isOpen, setIsOpen] = useState(false);

//   const toggleMenu = () => {
//     setIsOpen(!isOpen);
//   };

//   const PreconfiguredNavlink: typeof NavLink = forwardRef(({ ...props }, _) => {
//     return (
//       <CustomNavLink
//         {...props}
//         className="h-fit"
//         onClick={() => setIsOpen(false)}
//       />
//     );
//   });

//   const links = (
//     <>
//       {user ? (
//         <>
//           <PreconfiguredNavlink to="/location">
//             My Location
//           </PreconfiguredNavlink>
//           <PreconfiguredNavlink to="/friends">Friends</PreconfiguredNavlink>
//         </>
//       ) : (
//         <>
//           <PreconfiguredNavlink to="/">Home</PreconfiguredNavlink>
//           <PreconfiguredNavlink to="/login">Login</PreconfiguredNavlink>
//           <PreconfiguredNavlink to="/signup">Signup</PreconfiguredNavlink>
//         </>
//       )}
//     </>
//   );

//   const mobileMenuRef = useRef<HTMLDivElement>(null!);
//   useCloseWhenClickedOutside({
//     ref: mobileMenuRef,
//     open: isOpen,
//     setOpen: setIsOpen,
//   });

//   return (
//     <nav className="bg-gray-900 text-white shadow-lg w-screen px-4 sm:px-6 lg:px-8 absolute top-0 z-[1200]">
//       <div className="flex items-center justify-between h-16">
//         <NavLink to="/" className="text-white">
//           <div className="flex items-center">
//             <img
//               className="w-8 h-8 rounded-full"
//               src="/favicon/android-chrome-192x192.png"
//               alt="logo favicon"
//             />
//             <div className="text-sm sm:text-base md:text-xl font-bold mx-2">
//               wherearemyfriends.info
//             </div>
//           </div>
//         </NavLink>

//         <div className="hidden md:flex space-x-4">
//           <div className="flex items-center space-x-4">{links}</div>
//           <FoldableUserLogo />
//         </div>

//         <div className="flex md:hidden">
//           <button
//             onClick={toggleMenu}
//             className="text-white focus:outline-none"
//           >
//             {isOpen ? <FaX size={24} /> : <FaBars size={24} />}
//           </button>

//           <FoldableUserLogo />
//         </div>
//       </div>

//       <AnimatePresence>
//         {isOpen && (
//           <motion.div
//             ref={mobileMenuRef}
//             initial={{ height: 0 }}
//             animate={{ height: "auto" }}
//             exit={{ height: 0 }}
//             className="md:hidden bg-gray-800 overflow-hidden z-10 mb-4 sm:mb-6"
//           >
//             <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 flex flex-col">
//               {links}
//             </div>
//           </motion.div>
//         )}
//       </AnimatePresence>
//     </nav>
//   );
// };
